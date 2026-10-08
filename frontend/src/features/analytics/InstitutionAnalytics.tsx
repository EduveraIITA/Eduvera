import { ArrowRight, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { InstitutionSnapshot, RegisterSubmission } from "./api";
import { ComparisonBars, DonutChart, numberLabel, percentageLabel, shortDate } from "./AnalyticsCharts";

export function InstitutionSummary({ data, to }: { data: InstitutionSnapshot; to: string }) {
  return <Link to={to} className="analytics-panel analytics-summary-card analytics-panel--wide" aria-label="Explore institution snapshot">
    <header><h2>Institution snapshot</h2><ChevronRight size={18} aria-hidden="true" /></header>
    <p className="analytics-note">Current records · {shortDate(data.as_of)}</p>
    <dl className="analytics-kpis">
      <div><dt>Enrolled students</dt><dd>{numberLabel(data.students)}</dd></div>
      <div><dt>Active staff</dt><dd>{numberLabel(data.teaching_staff+data.non_teaching_staff)}</dd></div>
      <div><dt>Classes with students</dt><dd>{numberLabel(data.populated_classes)}</dd></div>
      <div><dt>Average class size</dt><dd>{data.average_class_size === null ? "—" : numberLabel(data.average_class_size)}</dd></div>
    </dl>
  </Link>;
}

export function InstitutionDetail({ data }: { data: InstitutionSnapshot }) {
  return <div className="analytics-sections">
    <section className="analytics-panel" aria-labelledby="institution-students-title">
      <header><h2 id="institution-students-title">Students & classes</h2></header>
      <div className="analytics-stat"><strong>{numberLabel(data.students)}</strong><span>enrolled students</span></div>
      <p className="analytics-support">{data.populated_classes} classes with students · {data.average_class_size === null ? "No average yet" : `${numberLabel(data.average_class_size)} students per class`}</p>
      {data.classes.length ? <ComparisonBars label="Enrolment by class" unit="count" rows={data.classes.map(cls => ({ id: cls.id, name: cls.name, value: cls.students, detail: cls.students ? "students" : "No active enrolments" }))} /> : <p className="analytics-empty">No classes configured for this academic year.</p>}
      <p className="analytics-note">{data.configured_classes} configured classes. Average class size excludes empty classes.</p>
      <details className="analytics-details"><summary>How enrolment is counted</summary><p className="analytics-note">Active enrolments in the selected term, starting by {shortDate(data.enrollment_as_of)}. Students do not need an app account to count. This is the current enrolment record, not historical intake growth or room capacity.</p></details>
      <Link className="analytics-module-link" to="/principal/students">View students & guardians<ArrowRight size={17} aria-hidden="true" /></Link>
    </section>
    <section className="analytics-panel" aria-labelledby="institution-staff-title">
      <header><h2 id="institution-staff-title">Staff mix</h2></header>
      <DonutChart label="Active staff mix" unit="active staff" slices={[
        { id: "teaching", label: "Teaching", value: data.teaching_staff, tone: "brand" },
        { id: "non-teaching", label: "Non-teaching", value: data.non_teaching_staff, tone: "positive" },
      ]} />
      <div className="analytics-stat"><strong>{data.students_per_teacher === null ? "—" : numberLabel(data.students_per_teacher)}</strong><span>students per teacher</span></div>
      <p className="analytics-note">Active teaching staff headcount, including part-time staff. Not a full-time-equivalent ratio, teaching load or staffing compliance measure.</p>
      <details className="analytics-details"><summary>How staff are counted</summary><p className="analytics-note">Active staff profiles who have joined by {shortDate(data.as_of)}. Onboarding, inactive and future joiners are excluded; an app account is not required. Enrolment and staff records need to be up to date for this ratio to be useful.</p></details>
      <Link className="analytics-module-link" to="/principal/staff">View staff<ArrowRight size={17} aria-hidden="true" /></Link>
    </section>
  </div>;
}

export function RegisterSummary({ data, to }: { data: RegisterSubmission; to: string }) {
  return <Link to={to} className="analytics-panel analytics-summary-card" aria-label="Explore register submission">
    <header><h2>Register submission</h2><ChevronRight size={18} aria-hidden="true" /></header>
    <div className="analytics-stat"><strong>{percentageLabel(data.percentage)}</strong><span>of scheduled registers</span></div>
    <p className="analytics-note">Current timetable · includes today</p>
    {data.expected ? <>
      <div className="analytics-register-meter" aria-hidden="true"><span style={{ width: `${data.percentage ?? 0}%` }} /></div>
      <p className="analytics-support">{numberLabel(data.submitted+data.locked)} of {numberLabel(data.expected)} submitted</p>
      <p className={`analytics-note${data.outstanding ? " analytics-warning" : ""}`}>{data.outstanding ? `${numberLabel(data.outstanding)} not submitted` : "All scheduled registers submitted"}</p>
    </> : <p className="analytics-empty">No scheduled registers in this period.</p>}
    {data.unscheduled_classes ? <p className="analytics-note">{data.unscheduled_classes} enrolled {data.unscheduled_classes === 1 ? "class has" : "classes have"} no scheduled days.</p> : null}
  </Link>;
}

export function RegisterDetail({ data }: { data: RegisterSubmission }) {
  return <div className="analytics-sections">
    <section className="analytics-panel" aria-labelledby="register-submission-title">
      <header><h2 id="register-submission-title">Scheduled registers</h2></header>
      <div className="analytics-stat"><strong>{percentageLabel(data.percentage)}</strong><span>submitted or locked</span></div>
      <DonutChart label="Scheduled register states" unit="registers" slices={[
        { id: "submitted", label: "Submitted", value: data.submitted, tone: "brand" },
        { id: "locked", label: "Locked", value: data.locked, tone: "positive" },
        { id: "outstanding", label: "Not submitted", value: data.outstanding, tone: "warning" },
      ]} />
      <p className="analytics-note">Includes today. Not submitted does not mean overdue or students absent.</p>
      <details className="analytics-details"><summary>How registers are counted</summary><p className="analytics-note">One register per class and scheduled day with active enrolled students. Uses the effective timetable, including published date changes and activities; closures, cancelled lessons and days before enrolment are excluded. Reopened drafts count as not submitted. This measures submission, not verified attendance accuracy. Historical expectations use the currently active enrolment records and current published schedule.</p></details>
      {data.unscheduled_classes ? <p className="analytics-note analytics-warning">{data.unscheduled_classes} enrolled {data.unscheduled_classes === 1 ? "class has" : "classes have"} no scheduled days in this period and cannot be included. Check the timetable before treating this as institution-wide coverage.</p> : null}
      <Link className="analytics-module-link" to="/principal/timetable">Review timetable<ArrowRight size={17} aria-hidden="true" /></Link>
    </section>
    <section className="analytics-panel" aria-labelledby="register-class-title">
      <header><h2 id="register-class-title">By class</h2></header>
      {data.classes.length ? <ul className="analytics-register-classes">{data.classes.map(cls => <li key={cls.id}>
        <div className="analytics-bars__label"><span>{cls.name}</span><strong>{percentageLabel(cls.percentage)}</strong></div>
        <p className="analytics-support">{cls.expected ? `${cls.submitted+cls.locked} of ${cls.expected} submitted` : "No scheduled days"}</p>
        {cls.expected ? <div className="analytics-register-meter" aria-hidden="true"><span style={{ width: `${cls.percentage ?? 0}%` }} /></div> : null}
        {cls.latest_unsubmitted ? <Link className="analytics-module-link" to={`/principal/attendance?${new URLSearchParams({ date: cls.latest_unsubmitted, class_section_id: cls.id })}`}>Review {shortDate(cls.latest_unsubmitted)} · {cls.outstanding} not submitted<ArrowRight size={17} aria-hidden="true" /></Link> : null}
      </li>)}</ul> : <p className="analytics-empty">No active enrolled classes in this period.</p>}
    </section>
  </div>;
}
