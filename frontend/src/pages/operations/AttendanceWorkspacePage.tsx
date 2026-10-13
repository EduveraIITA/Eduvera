import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarDays, CheckCheck, ChevronDown, ClipboardCheck, Clock3, LockKeyhole, Search, UsersRound, Inbox, X } from "lucide-react";
import type { AttentionItem, AttentionResponse } from "../../features/attention/api";
import type { AttendanceContinuityWorkspace, TeacherClassSummary } from "../../features/operations/api";
import { OperationsShell } from "./OperationsShell";
import { AttendanceContinuityPanel } from "./AttendanceContinuityPanel";
import { AttendanceDateControl } from '../../features/attendance/AttendanceDateControl';
import "./attendance-workspace.css";

type Queue = "all" | "attention" | "pending" | "submitted" | "locked";

const attentionPriority: Record<AttentionItem["priority"], number> = { urgent: 0, high: 1, normal: 2 };

function attentionParameters(item: AttentionItem) {
  try {
    return new URL(item.href, "https://school.invalid").searchParams;
  } catch {
    return new URLSearchParams();
  }
}

function registerAttentionClass(item: AttentionItem, date: string): string | null {
  if (!['attendance_register', 'attendance_scope_mismatch'].includes(item.source_kind)) return null;
  const parameters = attentionParameters(item);
  if (parameters.get("date") !== date) return null;
  return parameters.get("class_section_id") ?? (item.source_kind === "attendance_register" ? item.source_id : null);
}

function attentionTone(item: AttentionItem) {
  if (item.state === "exception" || item.priority === "urgent") return "exception";
  if (item.state === "new") return "new";
  return "action";
}

function strongerAttention(current: AttentionItem | undefined, incoming: AttentionItem) {
  if (!current) return incoming;
  const stateRank = { exception: 0, action_required: 1, new: 2 } as const;
  return stateRank[incoming.state] < stateRank[current.state]
    || (incoming.state === current.state && attentionPriority[incoming.priority] < attentionPriority[current.priority])
    ? incoming : current;
}

function registerQueue(item: TeacherClassSummary): Exclude<Queue, "all" | "attention"> | "not_required" {
  if (item.can_mark === false || item.instructional === false || item.date_open === false || !item.student_count) return "not_required";
  if (item.submission_authorized === false) return "pending";
  if (item.submission_status === "locked") return "locked";
  if (item.submission_status === "submitted") return "submitted";
  return "pending";
}

export function AttendanceWorkspacePage({ portal, classes, date, onDateChange, continuity, continuityLoading = false, continuityError = null, onContinuityDecision, initialReviewCaseId, attention }: {
  portal: "teacher" | "principal";
  classes: TeacherClassSummary[];
  date: string;
  onDateChange: (value: string) => void;
  continuity?: AttendanceContinuityWorkspace;
  continuityLoading?: boolean;
  continuityError?: Error | null;
  onContinuityDecision?: (caseId: string, decision: "accept" | "reject", reason: string, expectedRevision: number) => Promise<void>;
  initialReviewCaseId?: string;
  attention?: { data: AttentionResponse | undefined; isError: boolean; isPending?: boolean };
}) {
  const attentionState = attention ?? { data: undefined, isError: false, isPending: false };
  const [filter, setFilter] = useState<Queue>("all");
  const [search, setSearch] = useState("");
  const [searchOpen,setSearchOpen]=useState(false);
  const [deskOpen,setDeskOpen]=useState(Boolean(initialReviewCaseId));
  const searchButton=useRef<HTMLButtonElement>(null);
  const principal = portal === "principal";
  const attendanceAttention = (attentionState.data?.items ?? []).filter((item) => item.module === "attendance" || item.module === "registers");
  const classIds = new Set(classes.map((item) => item.class_section_id));
  const registerAttention = new Map<string, AttentionItem>();
  for (const item of attendanceAttention) {
    const classSectionId = registerAttentionClass(item, date);
    if (!classSectionId || !classIds.has(classSectionId)) continue;
    registerAttention.set(classSectionId, strongerAttention(registerAttention.get(classSectionId), item));
  }
  const placedAttentionIds = new Set([...registerAttention.values()].map((item) => item.id));
  const otherAttention = attendanceAttention.filter((item) => !placedAttentionIds.has(item.id));
  const exceptionAttention = attendanceAttention.find((item) => attentionTone(item) === "exception");
  const summaryTone = exceptionAttention ? "exception" : attendanceAttention.some((item) => attentionTone(item) === "new") ? "new" : "action";
  const reviewCount = !continuityLoading && !continuityError && continuity ? Math.max(continuity.summary.quarantined, continuity.cases.length) : 0;
  const counts = classes.reduce((result, item) => {
    const queue = registerQueue(item);
    if (queue !== "not_required") result[queue]++;
    return result;
  }, { pending: 0, submitted: 0, locked: 0 });
  const visible = classes.filter((item) => (filter === "all" || (filter === "attention" ? registerAttention.has(item.class_section_id) : registerQueue(item) === filter))
    && `${item.class_name} ${item.grade}${item.section} ${(item.assigned_teachers ?? []).join(" ")} ${(item.subjects ?? []).join(" ")}`.toLowerCase().includes(search.trim().toLowerCase()))
    .map((item, index) => ({ item, index, attention: registerAttention.get(item.class_section_id) }))
    .sort((left, right) => {
      if (Boolean(left.attention) !== Boolean(right.attention)) return left.attention ? -1 : 1;
      if (left.attention && right.attention) {
        const stateRank = { exception: 0, action_required: 1, new: 2 } as const;
        const state = stateRank[left.attention.state] - stateRank[right.attention.state];
        if (state) return state;
        const priority = attentionPriority[left.attention.priority] - attentionPriority[right.attention.priority];
        if (priority) return priority;
      }
      return left.index - right.index;
    }).map(({ item }) => item);
  const filters: Array<readonly [Queue, string, number]> = [
    ["all", "All registers", classes.length],
    ...(registerAttention.size ? [["attention", "Needs attention", registerAttention.size] as const] : []),
    ["pending", "To submit", counts.pending],
    ["submitted", principal ? "To review" : "Submitted", counts.submitted],
    ["locked", "Locked", counts.locked],
  ] as const;
  return <OperationsShell portal={portal} active="attendance" title="Attendance" subtitle={principal ? "School-wide registers" : "Your assigned classes"} contentHasHeading>
    <div className="attendance-workspace">
      <AttendanceDateControl date={date} onChange={onDateChange}/>
      <section className="attendance-workspace__queue" aria-labelledby="attendance-class-list">
        <h2 id="attendance-class-list" className="sr-only">Registers</h2>
        <div className="attendance-queue-toolbar">
          <label><span className="sr-only">Filter registers</span><select value={filter} onChange={e=>setFilter(e.target.value as Queue)}>{filters.map(([key,label,count])=><option key={key} value={key}>{label} · {count}</option>)}</select></label>
          <button ref={searchButton} type="button" aria-label="Search classes" aria-expanded={searchOpen} aria-controls="attendance-class-search" onClick={()=>{if(searchOpen)setSearch('');setSearchOpen(!searchOpen);}}><Search size={20}/></button>
          {principal && onContinuityDecision?<button type="button" title="Paper & offline entries" aria-label={`Paper & offline entries${reviewCount?`, ${reviewCount} to review`:''}`} aria-expanded={deskOpen} aria-controls="attendance-desk" onClick={()=>setDeskOpen(!deskOpen)}><Inbox size={20}/>{reviewCount?<span className="attendance-desk-count">{reviewCount}</span>:null}</button>:null}
        </div>
        {searchOpen?<div id="attendance-class-search" className="attendance-workspace__search"><Search size={18}/><label className="sr-only" htmlFor="attendance-search-input">Search classes</label><input id="attendance-search-input" autoFocus value={search} onChange={e=>setSearch(e.target.value)} placeholder={principal?'Class or teacher':'Class or subject'} onKeyDown={e=>{if(e.key==='Escape'){setSearch('');setSearchOpen(false);searchButton.current?.focus();}}}/><button type="button" aria-label="Clear and close search" onClick={()=>{setSearch('');setSearchOpen(false);searchButton.current?.focus();}}><X size={18}/></button></div>:null}
        {attentionState.isError ? <div className="attendance-attention-summary is-unavailable" role="status"><span className="attendance-attention-summary__mark" aria-hidden="true"/><span><strong>Attention status unavailable</strong><small>The register list is still current.</small></span></div> : null}
        {!attentionState.isError && attendanceAttention.length ? <div className={`attendance-attention-summary is-${summaryTone}`} role="status">
          <span className="attendance-attention-summary__mark" aria-hidden="true"/>
          <span><strong>{attendanceAttention.length} attendance {attendanceAttention.length === 1 ? "item needs" : "items need"} attention</strong><small>{registerAttention.size ? `${registerAttention.size} ${registerAttention.size === 1 ? "register" : "registers"} on this date` : "No affected register on this date"}{otherAttention.length ? ` · ${otherAttention.length} ${otherAttention.length === 1 ? "other review" : "other reviews"}` : ""}</small></span>
          {exceptionAttention && otherAttention.some((item) => item.id === exceptionAttention.id) ? <Link to={exceptionAttention.href}>Review exception<ArrowRight size={15}/></Link> : registerAttention.size ? <button type="button" aria-pressed={filter === "attention"} onClick={() => setFilter(filter === "attention" ? "all" : "attention")}>{filter === "attention" ? "Show all" : "Show affected"}</button> : otherAttention[0] ? <Link to={otherAttention[0].href}>Open next<ArrowRight size={15}/></Link> : null}
        </div> : null}
        {principal && onContinuityDecision && !deskOpen && (continuityError || reviewCount)?<button className="attendance-desk-notice" type="button" onClick={()=>setDeskOpen(true)}>{continuityError?'Attendance review unavailable':`${reviewCount} ${reviewCount === 1 ? 'entry needs' : 'entries need'} review`}<ArrowRight size={16}/></button>:null}
        {deskOpen && principal && onContinuityDecision ? <div id="attendance-desk"><AttendanceContinuityPanel key={initialReviewCaseId ?? "review-desk"}
        data={continuity}
        classes={classes}
        date={date}
        loading={continuityLoading}
        error={continuityError}
        initialCaseId={initialReviewCaseId}
        onDecision={onContinuityDecision}
      /></div> : null}
        <div className="attendance-workspace__cards">{visible.map((item) => {
          const attentionItem = registerAttention.get(item.class_section_id);
          const queue = registerQueue(item);
          const submitted = queue === "submitted" || queue === "locked";
          const savedWithoutSchedule = queue === "not_required" && (item.marked_count > 0 || item.submission_status !== "not_started");
          const assignmentMismatch = item.submission_authorized === false;
          const label = assignmentMismatch ? "Assignment mismatch" : queue === "locked" ? "Locked" : queue === "submitted" ? "Submitted" : queue === "not_required" ? savedWithoutSchedule ? "Schedule mismatch" : item.date_open === false ? "Upcoming" : "No register due" : item.marked_count > 0 ? "In progress" : "Not submitted";
          const name = item.class_name || `Class ${item.grade}${item.section}`;
          const teachers = item.assigned_teachers ?? [];
          return <article className={`attendance-class-card${attentionItem ? ` has-attention is-${attentionTone(attentionItem)}` : ""}`} key={item.class_section_id}>
            <div className="attendance-class-card__top"><span className="attendance-class-card__monogram">{item.grade}{item.section}</span><div><h3>{name}{attentionItem ? <span className={`attendance-class-card__attention-mark is-${attentionTone(attentionItem)}`} title={attentionItem.status_label}><span className="sr-only"> · {attentionItem.status_label}, needs attention</span></span> : null}</h3><p>{item.student_count} students{item.room_number ? ` · ${/^room\b/i.test(item.room_number) ? item.room_number : `Room ${item.room_number}`}` : ""}</p></div><span className={`attendance-class-card__status is-${queue}`}>{queue === "locked" ? <LockKeyhole size={13} /> : submitted ? <CheckCheck size={13} /> : <Clock3 size={13} />}{label}</span></div>
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
