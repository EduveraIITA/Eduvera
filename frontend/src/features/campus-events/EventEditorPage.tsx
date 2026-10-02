import { ArrowLeft, CalendarPlus2, Check, Plus, ShieldCheck, Trash2, UsersRound } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { eventTypeLabels } from "./EventPrimitives";
import type { CampusEventDto, CampusEventInput, EventCatalogResponse } from "./types";
import "./campus-events.css";

function localDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function defaultTimes() {
  const start = new Date();
  start.setDate(start.getDate() + 7);
  start.setHours(9, 0, 0, 0);
  const end = new Date(start);
  end.setHours(12, 0, 0, 0);
  return { start: localDateTime(start.toISOString()), end: localDateTime(end.toISOString()) };
}

function initialInput(event?: CampusEventDto): CampusEventInput {
  const times = defaultTimes();
  return event ? {
    event_type: event.event_type,
    subject_id: event.subject_id,
    title: event.title,
    description: event.description,
    venue: event.venue,
    starts_at: localDateTime(event.starts_at),
    ends_at: localDateTime(event.ends_at),
    audience: event.audience,
    participation_requirement: event.participation_requirement,
    requires_rsvp: event.participation_requirement === "optional" ? true : event.requires_rsvp,
    requires_guardian_consent: event.requires_guardian_consent,
    payment_required: event.payment_required,
    payment_amount_paise: event.payment_amount_paise,
    payment_due_on: event.payment_due_on,
    sessions: event.sessions.map(({ id, title, session_type, venue, starts_at, ends_at, attendance_mode }) => ({
      id, title, session_type, venue, starts_at: localDateTime(starts_at), ends_at: localDateTime(ends_at), attendance_mode,
      participant_student_ids: event.sessions.find((session) => session.id === id)?.participant_student_ids ?? [],
    })),
    checklist: event.checklist.map(({ id, label, required }) => ({ id, label, required })),
    staff: event.staff.map(({ user_id, role }) => ({ user_id, role })),
  } : {
    event_type: "other",
    subject_id: null,
    title: "",
    description: "",
    venue: "",
    starts_at: times.start,
    ends_at: times.end,
    audience: { mode: "school", class_section_ids: [], student_ids: [] },
    participation_requirement: "optional",
    requires_rsvp: true,
    requires_guardian_consent: false,
    payment_required: false,
    payment_amount_paise: null,
    payment_due_on: null,
    sessions: [{ title: "Main programme", session_type: "general", venue: "", starts_at: times.start, ends_at: times.end, attendance_mode: "none", participant_student_ids: [] }],
    checklist: [],
    staff: [],
  };
}

export function EventEditorPage({
  portal = "principal",
  catalog,
  event,
  onSave,
}: {
  portal?: "teacher" | "principal";
  catalog: EventCatalogResponse;
  event?: CampusEventDto;
  onSave: (input: CampusEventInput) => Promise<void>;
}) {
  const [input, setInput] = useState(() => initialInput(event));
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState("");
  const prefix = portal === "principal" ? "/principal" : "/teacher";
  const canManagePolicy = !event || event.permissions.can_manage_policy;
  const canManageAudience = !event || event.permissions.can_manage_audience;
  const canManageStaff = !event || event.permissions.can_manage_staff;
  const updateEventField = (field: "venue" | "starts_at" | "ends_at", value: string) => {
    const sessions = input.sessions.length === 1 && input.sessions[0]?.session_type === "general"
      ? input.sessions.map((session) => ({ ...session, [field === "venue" ? "venue" : field]: value }))
      : input.sessions;
    setInput({ ...input, [field]: value, sessions });
  };
  const students = useMemo(() => input.audience.mode === "class_sections"
    ? catalog.students.filter((student) => input.audience.class_section_ids.includes(student.class_section_id))
    : catalog.students, [catalog.students, input.audience]);
  const audienceStudentIds = useMemo(() => new Set(
    input.audience.mode === "students"
      ? input.audience.student_ids
      : input.audience.mode === "class_sections"
        ? catalog.students.filter((student) => input.audience.class_section_ids.includes(student.class_section_id)).map((student) => student.id)
        : catalog.students.map((student) => student.id),
  ), [catalog.students, input.audience]);

  const submit = async (formEvent: FormEvent) => {
    formEvent.preventDefault();
    setError("");
    if (new Date(input.ends_at) <= new Date(input.starts_at)) {
      setError("The event end must be after its start.");
      return;
    }
    if (input.audience.mode === "class_sections" && input.audience.class_section_ids.length === 0) {
      setError("Select at least one class for this audience.");
      return;
    }
    if (input.audience.mode === "students" && input.audience.student_ids.length === 0) {
      setError("Select at least one student for this audience.");
      return;
    }
    if (input.sessions.length === 0) {
      setError("Add at least one programme session before saving the draft.");
      return;
    }
    if (input.sessions.some((session) => new Date(session.ends_at) <= new Date(session.starts_at))) {
      setError("Every programme session must end after it starts.");
      return;
    }
    if (input.sessions.some((session) => new Date(session.starts_at) < new Date(input.starts_at) || new Date(session.ends_at) > new Date(input.ends_at))) {
      setError("Every programme session must stay inside the event start and end window.");
      return;
    }
    if (input.sessions.some((session) => (session.participant_student_ids ?? []).some((studentId) => !audienceStudentIds.has(studentId)))) {
      setError("A session includes a student who is no longer in the event audience. Review the session participants.");
      return;
    }
    if (input.payment_required && (!input.payment_amount_paise || input.payment_amount_paise < 100 || !input.payment_due_on)) {
      setError("Enter a valid event fee and due date before saving the draft.");
      return;
    }
    if (input.payment_required && input.payment_due_on! > input.starts_at.slice(0, 10)) {
      setError("The event fee due date cannot be after the event starts.");
      return;
    }
    setState("saving");
    try {
      await onSave({
        ...input,
        starts_at: new Date(input.starts_at).toISOString(),
        ends_at: new Date(input.ends_at).toISOString(),
        sessions: input.sessions.map((session) => ({ ...session, starts_at: new Date(session.starts_at).toISOString(), ends_at: new Date(session.ends_at).toISOString() })),
      });
    } catch (reason) {
      setState("error");
      setError(reason instanceof Error ? reason.message : "The event could not be saved.");
    }
  };

  return (
    <OperationsShell portal={portal} active="events" title={event ? "Edit event draft" : "Create event"} subtitle="Events & activities" contentHasHeading>
      <form className="campus-event-editor" onSubmit={submit}>
        <header className="campus-event-editor__header">
          <div><Link to={event ? `${prefix}/events/${event.id}` : `${prefix}/events`}><ArrowLeft size={17} />Back to events</Link><h1>{event ? event.title : "Create a school event"}</h1></div>
          <button className="campus-event-primary" type="submit" disabled={state === "saving"}><Check size={17} />{state === "saving" ? "Saving..." : "Save draft"}</button>
        </header>
        {error ? <p className="campus-event-form-error" role="alert">{error}</p> : null}

        <section className="campus-event-form-section" aria-labelledby="event-basics-heading">
          <header><span><CalendarPlus2 size={18} /></span><div><h2 id="event-basics-heading">Event details</h2><p>The public information families will see.</p></div></header>
          <div className="campus-event-form-grid">
            <label className="is-wide">Event name<input required value={input.title} onChange={(e) => setInput({ ...input, title: e.target.value })} placeholder="Class 7 educational excursion" /></label>
            {canManagePolicy ? <label>Event type<select value={input.event_type} onChange={(e) => setInput({ ...input, event_type: e.target.value as CampusEventInput["event_type"] })}>{Object.entries(eventTypeLabels).filter(([value]) => value !== "class_test").map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label> : <div className="campus-event-readonly-field"><span>Event type</span><strong>{eventTypeLabels[input.event_type]}</strong></div>}
            <label>Venue<input required value={input.venue} onChange={(e) => updateEventField("venue", e.target.value)} placeholder="School auditorium" /></label>
            <label>Starts<input required type="datetime-local" value={input.starts_at} onChange={(e) => updateEventField("starts_at", e.target.value)} /></label>
            <label>Ends<input required type="datetime-local" value={input.ends_at} onChange={(e) => updateEventField("ends_at", e.target.value)} /></label>
            <label className="is-wide">Description<textarea required rows={4} value={input.description} onChange={(e) => setInput({ ...input, description: e.target.value })} placeholder="Purpose, programme and what participants should expect." /></label>
          </div>
        </section>

        <section className="campus-event-form-section" aria-labelledby="event-participation-heading">
          <header><span><ShieldCheck size={18} /></span><div><h2 id="event-participation-heading">Participation & safeguards</h2><p>These controls remain independent from academic attendance.</p></div></header>
          {canManagePolicy ? <><div className="campus-event-choice-grid">
            <label><select aria-label="Participation requirement" value={input.participation_requirement} onChange={(e) => { const participation_requirement = e.target.value as CampusEventInput["participation_requirement"]; setInput({ ...input, participation_requirement, requires_rsvp: participation_requirement === "optional" ? true : input.requires_rsvp }); }}><option value="optional">Optional participation</option><option value="mandatory">Mandatory roster</option></select><small>Declining an optional event never creates an absence.</small></label>
            <label className="campus-event-check"><input type="checkbox" checked={input.requires_rsvp} disabled={input.participation_requirement === "optional"} onChange={(e) => setInput({ ...input, requires_rsvp: e.target.checked })} /><span><strong>Collect RSVP</strong><small>{input.participation_requirement === "optional" ? "Required because only accepted students form the participation roster." : "Families can accept or decline the invitation."}</small></span></label>
            <label className="campus-event-check"><input type="checkbox" checked={input.requires_guardian_consent} onChange={(e) => setInput({ ...input, requires_guardian_consent: e.target.checked })} /><span><strong>Guardian consent</strong><small>Use for excursions, off-site or higher-risk activities.</small></span></label>
            <label className="campus-event-check"><input type="checkbox" checked={input.payment_required} onChange={(e) => setInput({ ...input, payment_required: e.target.checked, payment_amount_paise: e.target.checked ? input.payment_amount_paise ?? 50_000 : null, payment_due_on: e.target.checked ? input.payment_due_on ?? input.starts_at.slice(0, 10) : null, requires_rsvp: e.target.checked && input.participation_requirement === "optional" ? true : input.requires_rsvp })} /><span><strong>Paid participation</strong><small>Publishes a linked fee obligation; payment is reconciled through the finance ledger.</small></span></label>
          </div>
          {input.payment_required ? <div className="campus-event-payment-fields"><label>Amount (INR)<input required type="number" min="1" step="0.01" value={(input.payment_amount_paise ?? 0) / 100} onChange={(e) => setInput({ ...input, payment_amount_paise: Math.round(Number(e.target.value) * 100) })} /></label><label>Payment due date<input required type="date" max={input.starts_at.slice(0, 10)} value={input.payment_due_on ?? ""} onChange={(e) => setInput({ ...input, payment_due_on: e.target.value })} /></label><p>{input.participation_requirement === "optional" ? "An invoice is created only after the family accepts the invitation." : "An invoice is created when the mandatory event is published."} No online payment action is shown here.</p></div> : null}
          </> : <div className="campus-event-protected-policy"><ShieldCheck size={18} /><div><strong>Administrator-controlled policy</strong><p>{input.participation_requirement === "optional" ? "Optional participation with RSVP" : "Mandatory participation"}{input.requires_guardian_consent ? " · Guardian consent required" : ""}{input.payment_required ? ` · Paid event at ₹${((input.payment_amount_paise ?? 0) / 100).toLocaleString("en-IN")}` : " · Free event"}</p><small>You can update delivery details and programme sessions. An administrator must change participation, consent or payment policy.</small></div></div>}
          <p className="campus-event-policy-note"><ShieldCheck size={15} />Academic attendance impact is locked to none. Any school-day reconciliation requires a separate approved attendance workflow.</p>
        </section>

        {canManageAudience ? <EventAudienceEditor input={input} catalog={catalog} students={students} onChange={setInput} /> : <ReadOnlyEventAudience input={input} catalog={catalog} />}
        {canManageStaff ? <EventStaffEditor input={input} catalog={catalog} onChange={setInput} /> : <ReadOnlyEventStaff input={input} catalog={catalog} />}
        <EventSessionEditor input={input} catalog={catalog} onChange={setInput} />
        <EventChecklistEditor input={input} onChange={setInput} />

        <footer className="campus-event-editor__footer"><Link to={event ? `${prefix}/events/${event.id}` : `${prefix}/events`}>Cancel</Link><button className="campus-event-primary" type="submit" disabled={state === "saving"}>{state === "saving" ? "Saving..." : "Save draft"}</button></footer>
      </form>
    </OperationsShell>
  );
}

function ReadOnlyEventAudience({ input, catalog }: { input: CampusEventInput; catalog: EventCatalogResponse }) {
  const classNames = catalog.class_sections
    .filter((item) => input.audience.class_section_ids.includes(item.id))
    .map((item) => item.name);
  const studentNames = catalog.students
    .filter((item) => input.audience.student_ids.includes(item.id))
    .map((item) => item.name);
  const audienceLabel = input.audience.mode === "school"
    ? "Whole school"
    : input.audience.mode === "class_sections"
      ? classNames.join(", ") || `${input.audience.class_section_ids.length} selected classes`
      : studentNames.slice(0, 3).join(", ") || `${input.audience.student_ids.length} selected students`;
  const remainder = input.audience.mode === "students" && studentNames.length > 3 ? ` and ${studentNames.length - 3} more` : "";

  return (
    <section className="campus-event-form-section" aria-labelledby="event-audience-heading">
      <header><span><UsersRound size={18} /></span><div><h2 id="event-audience-heading">Audience</h2><p>The published audience is controlled by a school administrator.</p></div></header>
      <div className="campus-event-protected-policy"><ShieldCheck size={18} /><div><strong>{audienceLabel}{remainder}</strong><p>{input.audience.mode === "school" ? "Every eligible student in the school is included." : input.audience.mode === "class_sections" ? `${input.audience.class_section_ids.length} ${input.audience.class_section_ids.length === 1 ? "class" : "classes"} included.` : `${input.audience.student_ids.length} individually selected ${input.audience.student_ids.length === 1 ? "student" : "students"}.`}</p><small>You can update event delivery and programme details, but cannot widen or narrow this audience.</small></div></div>
    </section>
  );
}

function EventAudienceEditor({ input, catalog, students, onChange }: { input: CampusEventInput; catalog: EventCatalogResponse; students: EventCatalogResponse["students"]; onChange: (input: CampusEventInput) => void }) {
  const [search, setSearch] = useState("");
  const visibleStudents = students.filter((student) => `${student.name} ${student.admission_number}`.toLowerCase().includes(search.trim().toLowerCase()));
  const changeAudience = (audience: CampusEventInput["audience"]) => {
    const allowed = new Set(audience.mode === "students" ? audience.student_ids : audience.mode === "class_sections" ? catalog.students.filter((student) => audience.class_section_ids.includes(student.class_section_id)).map((student) => student.id) : catalog.students.map((student) => student.id));
    onChange({ ...input, audience, sessions: input.sessions.map((session) => ({ ...session, participant_student_ids: (session.participant_student_ids ?? []).filter((id) => allowed.has(id)) })) });
  };
  return (
    <section className="campus-event-form-section" aria-labelledby="event-audience-heading">
      <header><span><UsersRound size={18} /></span><div><h2 id="event-audience-heading">Audience</h2><p>Only eligible users will receive the published event.</p></div></header>
      <div className="campus-event-segmented" role="radiogroup" aria-label="Event audience">{(["school", "class_sections", "students"] as const).map((mode) => <button key={mode} type="button" role="radio" aria-checked={input.audience.mode === mode} className={input.audience.mode === mode ? "is-active" : ""} onClick={() => changeAudience({ mode, class_section_ids: [], student_ids: [] })}>{mode === "school" ? "Whole school" : mode === "class_sections" ? "Selected classes" : "Selected students"}</button>)}</div>
      {input.audience.mode === "class_sections" ? catalog.class_sections.length ? <div className="campus-event-option-list">{catalog.class_sections.map((item) => <label key={item.id}><input type="checkbox" checked={input.audience.class_section_ids.includes(item.id)} onChange={(event) => changeAudience({ ...input.audience, class_section_ids: event.target.checked ? [...input.audience.class_section_ids, item.id] : input.audience.class_section_ids.filter((id) => id !== item.id) })} /><span><strong>{item.name}</strong><small>Grade {item.grade} · Section {item.section}</small></span></label>)}</div> : <p className="campus-event-inline-empty">No active classes are available in this school.</p> : null}
      {input.audience.mode === "students" ? <div className="campus-event-student-picker"><label className="campus-event-search">Find a student<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name or admission number" /></label><p>{input.audience.student_ids.length} selected · {visibleStudents.length} shown</p>{visibleStudents.length ? <div className="campus-event-option-list campus-event-option-list--students">{visibleStudents.map((item) => <label key={item.id}><input type="checkbox" checked={input.audience.student_ids.includes(item.id)} onChange={(event) => changeAudience({ ...input.audience, student_ids: event.target.checked ? [...input.audience.student_ids, item.id] : input.audience.student_ids.filter((id) => id !== item.id) })} /><span><strong>{item.name}</strong><small>{item.admission_number}</small></span></label>)}</div> : <p className="campus-event-inline-empty">No students match this search.</p>}</div> : null}
    </section>
  );
}

function EventSessionEditor({ input, catalog, onChange }: { input: CampusEventInput; catalog: EventCatalogResponse; onChange: (input: CampusEventInput) => void }) {
  const [searches, setSearches] = useState<Record<number, string>>({});
  const eligibleStudents = catalog.students.filter((student) => input.audience.mode === "school" || (input.audience.mode === "class_sections" ? input.audience.class_section_ids.includes(student.class_section_id) : input.audience.student_ids.includes(student.id)));
  const update = (index: number, patch: Partial<CampusEventInput["sessions"][number]>) => onChange({ ...input, sessions: input.sessions.map((session, i) => i === index ? { ...session, ...patch } : session) });
  const add = () => onChange({ ...input, sessions: [...input.sessions, { title: "Main session", session_type: "general", venue: input.venue, starts_at: input.starts_at, ends_at: input.ends_at, attendance_mode: "none", participant_student_ids: [] }] });
  return (
    <section className="campus-event-form-section" aria-labelledby="event-sessions-heading">
      <header><span><CalendarPlus2 size={18} /></span><div><h2 id="event-sessions-heading">Programme sessions</h2><p>At least one programme session is required. Attendance stays optional for each session.</p></div><button type="button" className="campus-event-secondary" onClick={add}><Plus size={16} />Add session</button></header>
      {input.sessions.length ? <div className="campus-event-editor-list">{input.sessions.map((session, index) => {
        const selected = session.participant_student_ids ?? [];
        const search = searches[index] ?? "";
        const shown = eligibleStudents.filter((student) => `${student.name} ${student.admission_number}`.toLowerCase().includes(search.trim().toLowerCase()));
        return <article key={session.id ?? index}>
          <div className="campus-event-form-grid">
            <label>Session name<input required value={session.title} onChange={(event) => update(index, { title: event.target.value })} /></label>
            <label>Session type<select value={session.session_type} onChange={(event) => update(index, { session_type: event.target.value as typeof session.session_type })}><option value="general">General</option><option value="rehearsal">Rehearsal</option><option value="departure">Departure</option><option value="activity">Activity</option><option value="return">Return</option></select></label>
            <label>Starts<input required type="datetime-local" value={session.starts_at} onChange={(event) => update(index, { starts_at: event.target.value })} /></label>
            <label>Ends<input required type="datetime-local" value={session.ends_at} onChange={(event) => update(index, { ends_at: event.target.value })} /></label>
            <label>Venue<input required value={session.venue} onChange={(event) => update(index, { venue: event.target.value })} /></label>
            <label>Event attendance<select value={session.attendance_mode} onChange={(event) => update(index, { attendance_mode: event.target.value as typeof session.attendance_mode })}><option value="none">No register</option><option value="check_in">Check-in only</option><option value="check_in_out">Check-in and check-out</option></select></label>
          </div>
          <details className="campus-event-session-audience">
            <summary>Session audience <span>{selected.length ? `${selected.length} selected` : `All ${eligibleStudents.length} invited`}</span></summary>
            <div className="campus-event-session-audience__body">
              <div className="campus-event-segmented" role="radiogroup" aria-label={`Audience for ${session.title}`}><button type="button" role="radio" aria-checked={selected.length === 0} className={selected.length === 0 ? "is-active" : ""} onClick={() => update(index, { participant_student_ids: [] })}>All invited</button><button type="button" role="radio" aria-checked={selected.length > 0} className={selected.length > 0 ? "is-active" : ""} disabled={eligibleStudents.length === 0} onClick={() => update(index, { participant_student_ids: selected.length ? selected : eligibleStudents[0] ? [eligibleStudents[0].id] : [] })}>Selected participants</button></div>
              {selected.length ? <><label className="campus-event-search">Find an invited student<input type="search" value={search} onChange={(event) => setSearches({ ...searches, [index]: event.target.value })} /></label><p>{selected.length} selected · {shown.length} shown. Keep at least one selected, or choose All invited.</p>{shown.length ? <div className="campus-event-option-list campus-event-option-list--students">{shown.map((student) => { const checked = selected.includes(student.id); return <label key={student.id}><input type="checkbox" checked={checked} disabled={checked && selected.length === 1} onChange={(event) => update(index, { participant_student_ids: event.target.checked ? [...selected, student.id] : selected.filter((id) => id !== student.id) })} /><span><strong>{student.name}</strong><small>{student.admission_number}</small></span></label>; })}</div> : <p className="campus-event-inline-empty">No invited students match this search.</p>}</> : <p>Every student in the event audience will be included in this session.</p>}
            </div>
          </details>
          <button type="button" className="campus-event-remove" disabled={input.sessions.length === 1} onClick={() => onChange({ ...input, sessions: input.sessions.filter((_, i) => i !== index) })} aria-label={`Remove ${session.title}`}><Trash2 size={16} />Remove</button>
        </article>;
      })}</div> : <p className="campus-event-form-error">Add at least one programme session.</p>}
    </section>
  );
}

function EventStaffEditor({ input, catalog, onChange }: { input: CampusEventInput; catalog: EventCatalogResponse; onChange: (input: CampusEventInput) => void }) {
  const assigned = input.staff ?? [];
  return <section className="campus-event-form-section" aria-labelledby="event-staff-heading"><header><span><UsersRound size={18} /></span><div><h2 id="event-staff-heading">Staff duties</h2><p>Assign one explicit responsibility per staff member. Only attendance takers can mark a general event register.</p></div></header>{catalog.staff.length ? <div className="campus-event-staff-list">{catalog.staff.map((staff) => { const assignment = assigned.find((item) => item.user_id === staff.user_id); return <article key={staff.user_id}><label><input type="checkbox" checked={Boolean(assignment)} onChange={(event) => onChange({ ...input, staff: event.target.checked ? [...assigned, { user_id: staff.user_id, role: "duty_staff" }] : assigned.filter((item) => item.user_id !== staff.user_id) })} /><span><strong>{staff.name}</strong><small>{assignment ? "Assigned to this event" : "Not assigned"}</small></span></label><select aria-label={`Duty for ${staff.name}`} disabled={!assignment} value={assignment?.role ?? "duty_staff"} onChange={(event) => onChange({ ...input, staff: assigned.map((item) => item.user_id === staff.user_id ? { ...item, role: event.target.value as typeof item.role } : item) })}><option value="organizer">Organizer: manage event</option><option value="duty_staff">Duty staff: view event</option><option value="attendance_taker">Attendance taker: mark register</option></select></article>; })}</div> : <p className="campus-event-inline-empty">No active staff members are available for event duty.</p>}</section>;
}

function ReadOnlyEventStaff({ input, catalog }: { input: CampusEventInput; catalog: EventCatalogResponse }) {
  const staffById = new Map(catalog.staff.map((staff) => [staff.user_id, staff.name]));
  return <section className="campus-event-form-section" aria-labelledby="event-staff-heading"><header><span><UsersRound size={18} /></span><div><h2 id="event-staff-heading">Staff duties</h2><p>Staff authority is managed by a school administrator.</p></div></header><div className="campus-event-protected-policy"><ShieldCheck size={18} /><div><strong>Assigned duties are read-only</strong>{input.staff?.length ? <ul>{input.staff.map((staff) => <li key={staff.user_id}>{staffById.get(staff.user_id) ?? "Assigned staff member"}: {staff.role.replace("_", " ")}</li>)}</ul> : <p>No additional staff duties are assigned.</p>}</div></div></section>;
}

function EventChecklistEditor({ input, onChange }: { input: CampusEventInput; onChange: (input: CampusEventInput) => void }) {
  const add = () => onChange({ ...input, checklist: [...input.checklist, { label: "", required: true }] });
  return <section className="campus-event-form-section" aria-labelledby="event-checklist-heading"><header><span><Check size={18} /></span><div><h2 id="event-checklist-heading">Participant checklist</h2><p>Give families a concise, checkable preparation list.</p></div><button type="button" className="campus-event-secondary" onClick={add}><Plus size={16} />Add item</button></header>{input.checklist.length ? <div className="campus-event-checklist-editor">{input.checklist.map((item, index) => <div key={item.id ?? index}><input required aria-label={`Checklist item ${index + 1}`} value={item.label} onChange={(e) => onChange({ ...input, checklist: input.checklist.map((entry, i) => i === index ? { ...entry, label: e.target.value } : entry) })} placeholder="Water bottle" /><label><input type="checkbox" checked={item.required} onChange={(e) => onChange({ ...input, checklist: input.checklist.map((entry, i) => i === index ? { ...entry, required: e.target.checked } : entry) })} />Required</label><button type="button" aria-label={`Remove checklist item ${index + 1}`} onClick={() => onChange({ ...input, checklist: input.checklist.filter((_, i) => i !== index) })}><Trash2 size={16} /></button></div>)}</div> : <p className="campus-event-inline-empty">No checklist items added.</p>}</section>;
}
