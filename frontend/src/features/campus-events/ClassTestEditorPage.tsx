import { ArrowLeft, BookOpenCheck, Check, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import type { CampusEventDto, CampusEventInput, EventCatalogResponse } from "./types";
import "./campus-events.css";

function localValue(value: string) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function initialTest(event?: CampusEventDto): CampusEventInput {
  if (event) return {
    event_type: "class_test",
    subject_id: event.subject_id,
    title: event.title,
    description: event.description,
    venue: event.venue,
    starts_at: localValue(event.starts_at),
    ends_at: localValue(event.ends_at),
    audience: event.audience,
    participation_requirement: "mandatory",
    requires_rsvp: false,
    requires_guardian_consent: false,
    payment_required: false,
    payment_amount_paise: null,
    payment_due_on: null,
    sessions: event.sessions.map(({ id, title, session_type, venue, starts_at, ends_at, attendance_mode, participant_student_ids }) => ({ id, title, session_type, venue, starts_at: localValue(starts_at), ends_at: localValue(ends_at), attendance_mode, participant_student_ids })),
    checklist: event.checklist.map(({ id, label, required }) => ({ id, label, required })),
    staff: event.staff.map(({ user_id, role }) => ({ user_id, role })),
  };
  const start = new Date();
  start.setDate(start.getDate() + 7);
  start.setHours(10, 0, 0, 0);
  const end = new Date(start);
  end.setMinutes(end.getMinutes() + 45);
  return {
    event_type: "class_test",
    subject_id: null,
    title: "",
    description: "",
    venue: "",
    starts_at: localValue(start.toISOString()),
    ends_at: localValue(end.toISOString()),
    audience: { mode: "class_sections", class_section_ids: [], student_ids: [] },
    participation_requirement: "mandatory",
    requires_rsvp: false,
    requires_guardian_consent: false,
    payment_required: false,
    payment_amount_paise: null,
    payment_due_on: null,
    sessions: [{ title: "Class test", session_type: "activity", venue: "", starts_at: localValue(start.toISOString()), ends_at: localValue(end.toISOString()), attendance_mode: "none", participant_student_ids: [] }],
    checklist: [],
    staff: [],
  };
}

export function ClassTestEditorPage({ portal, catalog, event, onSave }: { portal: "teacher" | "principal"; catalog: EventCatalogResponse; event?: CampusEventDto; onSave: (input: CampusEventInput) => Promise<void> }) {
  const [input, setInput] = useState(() => initialTest(event));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const prefix = portal === "teacher" ? "/teacher" : "/principal";
  const classId = input.audience.class_section_ids[0] ?? "";
  const subjects = useMemo(() => catalog.subjects.filter((subject) => !classId || subject.class_section_ids.includes(classId)), [catalog.subjects, classId]);

  const updateTiming = (field: "starts_at" | "ends_at", value: string) => {
    const next = { ...input, [field]: value };
    next.sessions = next.sessions.map((session) => ({ ...session, [field]: value }));
    setInput(next);
  };
  const submit = async (formEvent: FormEvent) => {
    formEvent.preventDefault();
    setError("");
    if (!classId || !input.subject_id) { setError("Select the class and subject for this test."); return; }
    if (new Date(input.ends_at) <= new Date(input.starts_at)) { setError("The test end must be after its start."); return; }
    if (input.starts_at.slice(0, 10) !== input.ends_at.slice(0, 10)) { setError("A class test must start and finish on one instructional day."); return; }
    setSaving(true);
    try {
      await onSave({ ...input, starts_at: new Date(input.starts_at).toISOString(), ends_at: new Date(input.ends_at).toISOString(), sessions: input.sessions.map((session) => ({ ...session, title: input.title || "Class test", venue: input.venue, starts_at: new Date(input.starts_at).toISOString(), ends_at: new Date(input.ends_at).toISOString() })) });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The class test could not be saved."); setSaving(false); }
  };

  return <OperationsShell portal={portal} active="home" title={event ? "Edit class test" : "Schedule class test"} subtitle="Events & activities" contentHasHeading><form className="campus-event-editor campus-test-editor" onSubmit={submit}><header className="campus-event-editor__header"><div><Link to={`${prefix}/events${event ? `/${event.id}` : ""}`}><ArrowLeft size={17} />Back</Link><span>Assessment schedule</span><h1>{event ? event.title : "Schedule a class test"}</h1><p>Publish a clear assessment plan to the assigned class without changing daily attendance.</p></div><button className="campus-event-primary" type="submit" disabled={saving}><Check size={17} />{saving ? "Saving..." : "Save draft"}</button></header>{error ? <p className="campus-event-form-error" role="alert">{error}</p> : null}<section className="campus-event-form-section"><header><span><BookOpenCheck size={18} /></span><div><h2>Test details</h2><p>Only classes and subjects in your current teaching scope are available.</p></div></header><div className="campus-event-form-grid"><label>Class<select required value={classId} onChange={(event) => { const nextClass = event.target.value; const validSubject = catalog.subjects.some((subject) => subject.id === input.subject_id && subject.class_section_ids.includes(nextClass)); setInput({ ...input, subject_id: validSubject ? input.subject_id : null, audience: { mode: "class_sections", class_section_ids: nextClass ? [nextClass] : [], student_ids: [] } }); }}><option value="">Select class</option>{catalog.class_sections.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Subject<select required value={input.subject_id ?? ""} onChange={(event) => setInput({ ...input, subject_id: event.target.value || null })}><option value="">Select subject</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label><label className="is-wide">Test title<input required value={input.title} onChange={(event) => setInput({ ...input, title: event.target.value })} placeholder="Algebra unit test" /></label><label>Starts<input required type="datetime-local" value={input.starts_at} onChange={(event) => updateTiming("starts_at", event.target.value)} /></label><label>Ends<input required type="datetime-local" value={input.ends_at} onChange={(event) => updateTiming("ends_at", event.target.value)} /></label><label className="is-wide">Venue<input required value={input.venue} onChange={(event) => setInput({ ...input, venue: event.target.value, sessions: input.sessions.map((session) => ({ ...session, venue: event.target.value })) })} placeholder="Room 204" /></label><label className="is-wide">Syllabus and preparation<textarea required rows={4} value={input.description} onChange={(event) => setInput({ ...input, description: event.target.value })} placeholder="Chapters, learning outcomes and preparation guidance" /></label></div><label className="campus-event-check campus-test-attendance"><input type="checkbox" checked={input.sessions[0]?.attendance_mode !== "none"} onChange={(event) => setInput({ ...input, sessions: input.sessions.map((session) => ({ ...session, attendance_mode: event.target.checked ? "check_in" : "none" })) })} /><span><strong>Use an event participation register</strong><small>This records who attended the test session. It does not alter the daily academic register.</small></span></label></section><section className="campus-event-form-section"><header><span><Check size={18} /></span><div><h2>Materials checklist</h2><p>Optional items students should bring.</p></div><button type="button" className="campus-event-secondary" onClick={() => setInput({ ...input, checklist: [...input.checklist, { label: "", required: true }] })}><Plus size={16} />Add item</button></header>{input.checklist.length ? <div className="campus-event-checklist-editor">{input.checklist.map((item, index) => <div key={item.id ?? index}><input required aria-label={`Material ${index + 1}`} value={item.label} onChange={(event) => setInput({ ...input, checklist: input.checklist.map((current, itemIndex) => itemIndex === index ? { ...current, label: event.target.value } : current) })} placeholder="Geometry set" /><label><input type="checkbox" checked={item.required} onChange={(event) => setInput({ ...input, checklist: input.checklist.map((current, itemIndex) => itemIndex === index ? { ...current, required: event.target.checked } : current) })} />Required</label><button type="button" aria-label={`Remove material ${index + 1}`} onClick={() => setInput({ ...input, checklist: input.checklist.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 size={16} /></button></div>)}</div> : <p className="campus-event-inline-empty">No special materials added.</p>}</section><p className="campus-event-policy-note"><ShieldCheck size={15} />Class-test participation is mandatory, with no RSVP, guardian consent or payment workflow. Absence decisions remain in the daily academic register.</p><footer className="campus-event-editor__footer"><Link to={`${prefix}/events${event ? `/${event.id}` : ""}`}>Cancel</Link><button className="campus-event-primary" type="submit" disabled={saving}>{saving ? "Saving..." : "Save draft"}</button></footer></form></OperationsShell>;
}
