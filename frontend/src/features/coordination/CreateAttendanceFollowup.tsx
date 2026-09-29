import { useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MessageSquarePlus } from "lucide-react";
import { useOptionalAuth } from "../auth/AuthContext";
import { createFollowup } from "./api";
import "./followups.css";

interface Props { students: Array<{ id: string; name: string; attendance_id: string | null; status: string | null }>; date: string }
export function CreateAttendanceFollowup(props: Props) {
  const auth = useOptionalAuth();
  if (auth?.status !== "authenticated") return null;
  return <CreateForm {...props} />;
}
function CreateForm({ students, date }: Props) {
  const cache = useQueryClient();
  const eligible = students.filter((student) => student.attendance_id && ["absent", "late", "half_day"].includes(student.status ?? ""));
  const [open, setOpen] = useState(false);
  const [studentId, setStudentId] = useState("");
  const [question, setQuestion] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const attempt = useRef<{ body: string; id: string } | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const input = { student_id: studentId, attendance_date: date, question, due_at: new Date(due).toISOString() };
      const fingerprint = JSON.stringify(input);
      if (attempt.current?.body !== fingerprint) attempt.current = { body: fingerprint, id: crypto.randomUUID() };
      await createFollowup({ ...input, idempotency_key: attempt.current.id });
      await cache.invalidateQueries({ queryKey: ["school", "coordination"] });
      setSaved(true); setOpen(false); setQuestion(""); attempt.current = null;
    } catch (err) { setError(err instanceof Error ? err.message : "Follow-up could not be created."); }
    finally { setBusy(false); }
  };
  return <section className="followup-panel"><header className="followup-panel__heading"><div><span className="followup-eyebrow">Close the loop</span><h2>Need a guardian’s clarification?</h2></div>
    <button className="followup-secondary" type="button" aria-expanded={open} disabled={!eligible.length} onClick={() => { setOpen(!open); setSaved(false); }}><MessageSquarePlus size={18} />{open ? "Cancel" : "Raise follow-up"}</button>
  </header>
    {!eligible.length ? <p className="followup-meta">Follow-ups are available for saved absences, late arrivals, and half days.</p> : null}
    {saved ? <p role="status" className="followup-confirmation">Follow-up opened. You are the responsible owner; it is available in Attendance follow-ups on your home page.</p> : null}
    {open ? <form className="followup-form" onSubmit={(event) => void submit(event)}>
      <div className="followup-form__grid"><label>Student<select required value={studentId} onChange={(event) => setStudentId(event.target.value)}><option value="">Select student</option>{eligible.map((student) => <option key={student.id} value={student.id}>{student.name} · {student.status?.replace("_", " ")}</option>)}</select></label>
      <label>Response due<input required type="datetime-local" value={due} onChange={(event) => setDue(event.target.value)} /></label></div>
      <label>Question for the guardian<textarea required minLength={3} maxLength={1000} rows={3} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Please help us understand the recorded absence." /></label>
      <p className="followup-meta">This opens a follow-up. The recorded attendance stays unchanged.</p>
      {error ? <p className="followup-error" role="alert">{error}</p> : null}<button className="followup-primary" type="submit" disabled={busy}>{busy ? "Opening…" : "Open follow-up"}</button>
    </form> : null}
  </section>;
}
