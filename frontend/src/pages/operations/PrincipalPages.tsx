import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, CalendarCheck, CalendarDays, CheckCircle2, Clock3, LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react";
import type { NewTimetableSlot, PrincipalHomeResponse, PrincipalTimetableResponse } from "../../features/operations/api";
import { OperationsShell } from "./OperationsShell";
import { AttendanceWorkspacePage } from "./AttendanceWorkspacePage";
import { FollowupInbox } from "../../features/coordination/FollowupInbox";
import { HomeActionDeck, HomeActionSpotlight } from "../../features/home-actions/HomeActionDeck";

function time(value: string) {
  const [hour = "0", minute = "00"] = value.split(":");
  const numeric = Number(hour);
  return `${numeric % 12 || 12}:${minute} ${numeric >= 12 ? "PM" : "AM"}`;
}

export function PrincipalHomePage({ data, date, onDateChange }: { data: PrincipalHomeResponse; date: string; onDateChange: (date: string) => void }) {
  const coverage = data.summary.classes_total ? Math.round(data.summary.classes_submitted * 100 / data.summary.classes_total) : 100;
  const selectedDateLabel = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${date}T12:00:00+05:30`));
  const [primaryAction, ...remainingActions] = data.home_actions ?? [];
  return <OperationsShell portal="principal" active="home" title="School operations" subtitle={`${data.principal.name} - Principal workspace`}>
    <div className="operations-stack principal-home">
      <section className="teacher-home__day principal-home__hero" aria-labelledby="principal-home-heading">
        <header>
          <div><span>School pulse</span><h2 id="principal-home-heading">{selectedDateLabel}</h2></div>
          <label><span className="sr-only">Choose date</span><CalendarDays size={18} aria-hidden="true" /><input type="date" aria-label="Choose date" value={date} onChange={(event) => onDateChange(event.target.value)} /></label>
        </header>
        <div className="teacher-home__day-summary">
          <div>
            <strong>{data.summary.classes_total ? `${data.summary.classes_submitted} of ${data.summary.classes_total} registers` : "No registers due"}</strong>
            <span>{data.summary.classes_total ? `${data.summary.marked} of ${data.summary.students} students marked, ${data.summary.absent} absent and ${data.summary.late} late` : "No scheduled attendance is required for this date"}</span>
          </div>
          {data.summary.classes_total ? <b>{coverage}%</b> : <CheckCircle2 size={25} aria-label="Day clear" />}
        </div>
        {data.summary.classes_total ? <div className="teacher-home__progress" aria-label={`${coverage}% of class registers submitted`}><i style={{ width: `${coverage}%` }} /></div> : null}
        {primaryAction ? <HomeActionSpotlight action={primaryAction} tone="brand" /> : <div className="teacher-home__caught-up" role="status"><CheckCircle2 size={20} aria-hidden="true" /><span><strong>Operations are clear</strong><small>No school action needs your attention right now.</small></span></div>}
      </section>
      <HomeActionDeck actions={remainingActions.slice(0, 4)} title="Later" variant="quiet" />
      <FollowupInbox context="staff" hideWithoutOpenFollowups />
      {data.exceptions.length ? <section className="operations-panel principal-exceptions"><header><h2>Attendance exceptions</h2><b>Minimum 5 recorded days</b></header><div>{data.exceptions.map((student) => <article key={student.id}><span className="exception-score">{student.percentage}%</span><span><strong>{student.name}</strong><small>{student.class_name} - {student.admission_number}</small></span><span><small>School threshold</small><strong>{student.threshold}%</strong></span></article>)}</div></section> : null}
      <section className="operations-panel principal-class-coverage"><header><h2>Class register coverage</h2><Link className="operations-action-link" to={`/principal/attendance?date=${date}`}>Attendance desk <ArrowRight size={15}/></Link></header>{data.classes.length ? <div className="principal-table"><div className="principal-table__head"><span>Class</span><span>Register</span><span>Attendance</span><span>Timetable</span><span/></div>{data.classes.map((item) => { const assignmentMismatch = item.submission_authorized === false; const scheduleMismatch = item.can_mark === false && (item.marked_count > 0 || item.submission_status !== "not_started"); const mismatch = assignmentMismatch || scheduleMismatch; return <article key={item.id}><span><strong>{item.name}</strong><small>{item.room_number || "Room pending"}</small></span><span><b className={`submission-chip is-${mismatch ? "upcoming" : item.can_mark === false ? "upcoming" : item.submission_status}`}>{assignmentMismatch ? "assignment mismatch" : scheduleMismatch ? "schedule mismatch" : item.can_mark === false ? "upcoming" : item.submission_status.replace("_", " ")}</b><small>{item.marked_count}/{item.student_count} marked</small></span><span><strong>{item.attendance_percentage}%</strong><small>{item.absent_count} absent - {item.late_count} late</small></span><span><strong>{item.timetable_slots} slots</strong><small>{item.unassigned_slots ? `${item.unassigned_slots} unassigned` : "Fully assigned"}</small></span>{item.can_mark === false && !mismatch ? <span className="teacher-class-list__inactive">Opens on this date</span> : <Link className="operations-action-link" to={`/principal/attendance?class_section_id=${item.id}&date=${date}`}>{mismatch ? "Review record" : "Review"} <ArrowRight size={15}/></Link>}</article>; })}</div> : <div className="operations-empty"><CalendarCheck size={24}/><div><strong>No class registers due</strong><p>The published timetable has no attendance-eligible lessons for this date.</p></div></div>}</section>
    </div>
  </OperationsShell>;
}

export function PrincipalAttendancePage({ data, date, onDateChange }: { data: PrincipalHomeResponse; date: string; onDateChange: (date: string) => void }) {
  return <AttendanceWorkspacePage portal="principal" classes={data.classes} date={date} onDateChange={onDateChange} />;
}

const initialSlot = (data: PrincipalTimetableResponse): NewTimetableSlot => ({ class_section_id: data.classes[0]?.id ?? "", subject_id: data.subjects[0]?.id ?? null, teacher_user_id: data.teachers[0]?.id ?? null, weekday: 1, period_number: 1, starts_at: "08:00", ends_at: "08:45", slot_type: "class", title: "", room: data.classes[0]?.room_number ?? "", teacher_designation: "Subject Teacher" });

export function PrincipalTimetablePage({ data, onCreate, onUpdate, onDelete }: { data: PrincipalTimetableResponse; onCreate: (slot: NewTimetableSlot) => Promise<void>; onUpdate: (id: string, slot: NewTimetableSlot) => Promise<void>; onDelete: (id: string) => Promise<void> }) {
  const [open, setOpen] = useState(false); const [editingId, setEditingId] = useState<string | null>(null); const [slot, setSlot] = useState(() => initialSlot(data)); const [state, setState] = useState<"idle"|"saving"|"saved"|"error">("idle"); const [message, setMessage] = useState("");
  const days = useMemo(() => { const map = new Map<string, PrincipalTimetableResponse["slots"]>(); for (const item of data.slots) map.set(item.weekday_label, [...(map.get(item.weekday_label) ?? []), item]); return [...map.entries()]; }, [data.slots]);
  const startNew = () => { setEditingId(null); setSlot(initialSlot(data)); setMessage(""); setOpen(true); };
  const startEdit = (item: PrincipalTimetableResponse["slots"][number]) => { setEditingId(item.id); setSlot({ class_section_id:item.class_section_id, subject_id:item.subject_id, teacher_user_id:item.teacher_user_id, weekday:item.weekday, period_number:item.period_number, starts_at:item.starts_at.slice(0,5), ends_at:item.ends_at.slice(0,5), slot_type:item.slot_type, title:item.subject_id ? "" : item.display_title, room:item.room, teacher_designation:"Subject Teacher" }); setMessage(""); setOpen(true); window.scrollTo({top:0,behavior:"smooth"}); };
  const submit = async (event: FormEvent) => { event.preventDefault(); setState("saving"); setMessage(""); try { if(editingId) await onUpdate(editingId,slot); else await onCreate(slot); setState("saved"); setMessage(editingId ? "Period updated successfully." : "Period published successfully."); setOpen(false); setEditingId(null); } catch (error) { setState("error"); setMessage(error instanceof Error ? error.message : "The period could not be saved."); } };
  const remove = async () => { if(!editingId || !window.confirm("Remove this timetable period? This action is recorded in the audit log.")) return; setState("saving"); try { await onDelete(editingId); setState("saved"); setMessage("Period removed successfully."); setOpen(false); setEditingId(null); } catch(error) { setState("error"); setMessage(error instanceof Error ? error.message : "The period could not be removed."); } };
  return <OperationsShell portal="principal" active="timetable" title="Master timetable" subtitle="Scheduling, staffing and conflict control"><div className="operations-stack">
    <section className="operations-hero operations-hero--principal"><div><span>Published schedule</span><h2>{data.slots.length} periods across {data.classes.length} classes</h2><p>Every class, room, teacher, and time window is checked before publication.</p></div><button className="operations-primary-button" onClick={startNew}><Plus size={17}/>Add period</button></section>
    {data.conflicts.length ? <section className="operations-alert"><AlertTriangle size={20}/><div><strong>{data.conflicts.length} scheduling conflicts need attention</strong><p>Resolve overlapping room or teacher allocations before the timetable is considered final.</p></div></section> : <section className="operations-alert is-success"><CheckCircle2 size={20}/><div><strong>No scheduling conflicts</strong><p>Published teacher and room allocations do not overlap.</p></div></section>}
    {open ? <form className="operations-panel timetable-form" onSubmit={(event) => void submit(event)}><header><div><span>{editingId ? "Edit timetable period" : "New timetable period"}</span><h2>Schedule details</h2></div></header><div className="timetable-form__grid"><label>Class<select required value={slot.class_section_id} onChange={(event) => { const selected=data.classes.find((item)=>item.id===event.target.value); setSlot({...slot,class_section_id:event.target.value,room:selected?.room_number ?? slot.room}); }}>{data.classes.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Subject<select value={slot.subject_id ?? ""} onChange={(event)=>setSlot({...slot,subject_id:event.target.value || null})}><option value="">Activity / break</option>{data.subjects.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Teacher<select value={slot.teacher_user_id ?? ""} onChange={(event)=>setSlot({...slot,teacher_user_id:event.target.value || null})}><option value="">Unassigned</option>{data.teachers.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Day<select value={slot.weekday} onChange={(event)=>setSlot({...slot,weekday:Number(event.target.value)})}>{["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].map((day,index)=><option key={day} value={index+1}>{day}</option>)}</select></label><label>Period<input type="number" min="1" max="20" value={slot.period_number} onChange={(event)=>setSlot({...slot,period_number:Number(event.target.value)})}/></label><label>Room<input required={slot.slot_type === "class"} value={slot.room} onChange={(event)=>setSlot({...slot,room:event.target.value})}/></label><label>Starts<input required type="time" value={slot.starts_at} onChange={(event)=>setSlot({...slot,starts_at:event.target.value})}/></label><label>Ends<input required type="time" value={slot.ends_at} onChange={(event)=>setSlot({...slot,ends_at:event.target.value})}/></label></div><footer><span>{editingId ? <button className="timetable-delete" type="button" onClick={()=>void remove()}><Trash2 size={16}/>Remove period</button> : <button type="button" onClick={()=>setOpen(false)}>Cancel</button>}</span><button type="submit" disabled={state==="saving"}>{state==="saving"?<LoaderCircle className="spin" size={17}/>:editingId?<Pencil size={17}/>:<Plus size={17}/>}{editingId ? "Save changes" : "Publish period"}</button></footer></form> : null}
    {message ? <p className={state === "error" ? "operations-error" : "operations-success"} role="status">{message}</p> : null}
    <section className="principal-timetable-grid">{days.map(([day, slots])=><article className="operations-panel" key={day}><header><div><span>Schedule</span><h2>{day}</h2></div><b>{slots.length} periods</b></header><div>{slots.map((item)=><section key={item.id}><span><Clock3 size={15}/>{time(item.starts_at)}-{time(item.ends_at)}</span><span><strong>{item.display_title}</strong><small>{item.class_name} - {item.teacher_name ?? "Unassigned"}</small></span><button className="principal-slot-edit" type="button" onClick={()=>startEdit(item)} aria-label={`Edit ${item.display_title} for ${item.class_name}`}><b>{item.room || "-"}</b><Pencil size={13}/></button></section>)}</div></article>)}</section>
  </div></OperationsShell>;
}
