import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarDays, CheckCheck, ChevronDown, ClipboardCheck, Clock3, LockKeyhole, Search, UsersRound } from "lucide-react";
import type { AttendanceContinuityWorkspace, TeacherClassSummary } from "../../features/operations/api";
import { OperationsShell } from "./OperationsShell";
import { AttendanceContinuityPanel } from "./AttendanceContinuityPanel";
import "./attendance-workspace.css";

type Queue = "all" | "pending" | "submitted" | "locked";

function registerQueue(item: TeacherClassSummary): Exclude<Queue, "all"> | "not_required" {
  if (item.can_mark === false || item.instructional === false || item.date_open === false || !item.student_count) return "not_required";
  if (item.submission_authorized === false) return "pending";
  if (item.submission_status === "locked") return "locked";
  if (item.submission_status === "submitted") return "submitted";
  return "pending";
}

export function AttendanceWorkspacePage({ portal, classes, date, onDateChange, continuity, continuityLoading = false, continuityError = null, onContinuityDecision }: {
  portal: "teacher" | "principal";
  classes: TeacherClassSummary[];
  date: string;
  onDateChange: (value: string) => void;
  continuity?: AttendanceContinuityWorkspace;
  continuityLoading?: boolean;
  continuityError?: Error | null;
  onContinuityDecision?: (caseId: string, decision: "accept" | "reject", reason: string, expectedRevision: number) => Promise<void>;
}) {
  const [filter, setFilter] = useState<Queue>("all");
  const [search, setSearch] = useState("");
  const principal = portal === "principal";
  const counts = classes.reduce((result, item) => {
    const queue = registerQueue(item);
    if (queue !== "not_required") result[queue]++;
    return result;
  }, { pending: 0, submitted: 0, locked: 0 });
  const dueCount = counts.pending + counts.submitted + counts.locked;
  const visible = classes.filter((item) => (filter === "all" || registerQueue(item) === filter)
    && `${item.class_name} ${item.grade}${item.section} ${(item.assigned_teachers ?? []).join(" ")} ${(item.subjects ?? []).join(" ")}`.toLowerCase().includes(search.trim().toLowerCase()));
  const filters = [
    ["all", "All registers", classes.length],
    ["pending", "To submit", counts.pending],
    ["submitted", principal ? "To review" : "Submitted", counts.submitted],
    ["locked", "Locked", counts.locked],
  ] as const;
  return <OperationsShell portal={portal} active="attendance" title="Attendance" subtitle={principal ? "School-wide registers" : "Your assigned classes"} contentHasHeading>
    <div className="attendance-workspace">
      <section className="attendance-workspace__hero">
        <div className="attendance-workspace__heading">
          <h1>{principal ? "School attendance" : "Class registers"}</h1>
          <label><CalendarDays size={17} /><span className="sr-only">Register date</span><input type="date" value={date} onChange={(event) => { if (event.target.value) onDateChange(event.target.value); }} /></label>
        </div>
        <div className="attendance-workspace__totals" aria-label="Register overview">
          <div><strong>{dueCount}</strong><span>Registers</span></div>
          <div><strong>{counts.pending}</strong><span>To submit</span></div>
          <div><strong>{counts.submitted + counts.locked}</strong><span>Submitted</span></div>
        </div>
      </section>
      {principal && onContinuityDecision ? <AttendanceContinuityPanel
        data={continuity}
        classes={classes}
        date={date}
        loading={continuityLoading}
        error={continuityError}
        onDecision={onContinuityDecision}
      /> : null}
      <section className="attendance-workspace__queue" aria-labelledby="attendance-class-list">
        <div className="attendance-workspace__list-heading"><h2 id="attendance-class-list">Registers</h2></div>
        <label className="attendance-workspace__search"><Search size={18} /><span className="sr-only">Search classes</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={principal ? "Search class or teacher" : "Search class or subject"} /></label>
        <div className="attendance-workspace__filters" role="group" aria-label="Filter registers">{filters.map(([key, label, count]) => <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}<span>{count}</span></button>)}</div>
        <div className="attendance-workspace__cards">{visible.map((item) => {
          const queue = registerQueue(item);
          const submitted = queue === "submitted" || queue === "locked";
          const savedWithoutSchedule = queue === "not_required" && (item.marked_count > 0 || item.submission_status !== "not_started");
          const assignmentMismatch = item.submission_authorized === false;
          const label = assignmentMismatch ? "Assignment mismatch" : queue === "locked" ? "Locked" : queue === "submitted" ? "Submitted" : queue === "not_required" ? savedWithoutSchedule ? "Schedule mismatch" : item.date_open === false ? "Upcoming" : "No register due" : item.marked_count > 0 ? "In progress" : "Not submitted";
          const name = item.class_name || `Class ${item.grade}${item.section}`;
          const teachers = item.assigned_teachers ?? [];
          return <article className="attendance-class-card" key={item.class_section_id}>
            <div className="attendance-class-card__top"><span className="attendance-class-card__monogram">{item.grade}{item.section}</span><div><h3>{name}</h3><p>{item.student_count} students{item.room_number ? ` · ${/^room\b/i.test(item.room_number) ? item.room_number : `Room ${item.room_number}`}` : ""}</p></div><span className={`attendance-class-card__status is-${queue}`}>{queue === "locked" ? <LockKeyhole size={13} /> : submitted ? <CheckCheck size={13} /> : <Clock3 size={13} />}{label}</span></div>
            {principal ? <details className="attendance-class-card__team"><summary><UsersRound size={15} /><span>{teachers.length ? `${teachers.length} assigned ${teachers.length === 1 ? "teacher" : "teachers"}` : "No teaching assignment"}</span><ChevronDown size={15} /></summary><p>{teachers.length ? teachers.join(" · ") : "Assign teachers through the school timetable."}</p></details> : <p className="attendance-class-card__assignment"><CalendarDays size={15} /><span>{item.assignment_kind === "substitute" ? "Accepted cover" : item.subjects?.filter(Boolean).join(" · ") || "Assigned class"}{item.periods_today ? ` · ${item.periods_today} ${item.periods_today === 1 ? "period" : "periods"} on this day` : " · No lesson on this day"}</span></p>}
            <div className="attendance-class-card__progress"><span>{item.marked_count}/{item.student_count} marked</span><progress value={item.marked_count} max={item.student_count || 1} aria-label={`${name} students marked`} /></div>
            <div className="attendance-class-card__bottom"><span>{assignmentMismatch ? `Submitted by ${item.submitted_by_name ?? "an unscheduled user"}; assignment review is required.` : savedWithoutSchedule ? "Saved attendance exists without a scheduled lesson." : submitted ? item.submitted_by_name ? `Submitted by ${item.submitted_by_name}` : "Submitted register" : queue === "not_required" ? item.availability_reason ?? (item.date_open === false ? "Opens on the selected date" : "No register due") : principal ? "Awaiting teacher submission" : "Complete and submit"}</span>{(savedWithoutSchedule || assignmentMismatch) && principal ? <Link to={`/${portal}/attendance?class_section_id=${encodeURIComponent(item.class_section_id)}&date=${date}`} aria-label={`Review ${assignmentMismatch ? "assignment" : "schedule"} mismatch for ${name}`}>Review record<ArrowRight size={16} /></Link> : queue === "not_required" ? <span className="attendance-class-card__inactive">No action required</span> : <Link to={`/${portal}/attendance?class_section_id=${encodeURIComponent(item.class_section_id)}&date=${date}`} aria-label={`${principal || submitted ? "Review" : "Take attendance for"} ${name}`}>{principal || submitted ? "Review" : "Take attendance"}<ArrowRight size={16} /></Link>}</div>
          </article>;
        })}</div>
        {!visible.length ? <div className="attendance-workspace__empty"><ClipboardCheck size={28} /><h3>{classes.length ? "No registers in this view" : "No attendance due"}</h3><p>{classes.length ? "Choose another filter or search for a class." : principal ? "There are no scheduled class registers for this date." : "You have no scheduled lesson or accepted cover requiring attendance on this date."}</p>{classes.length ? <button type="button" onClick={() => { setFilter("all"); setSearch(""); }}>Show all registers</button> : null}</div> : null}
      </section>
    </div>
  </OperationsShell>;
}
